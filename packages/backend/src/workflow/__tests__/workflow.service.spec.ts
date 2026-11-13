import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkflowService } from '../workflow.service';
import {
  createMockPrismaService,
  createMockCacheService,
  createMockPluginEventService,
} from '../../testing';

// Mock RequestContextService to prevent @TenantScoped from throwing in tests
jest.mock('../../utils/request-context.service', () => ({
  RequestContextService: {
    getCurrentContext: jest.fn(() => ({ tenantSlug: 'test-tenant' })),
  },
}));

describe('WorkflowService', () => {
  let service: WorkflowService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let cache: ReturnType<typeof createMockCacheService>;
  let events: ReturnType<typeof createMockPluginEventService>;
  let tenantClient: any;

  const TENANT_SLUG = 'test-tenant';
  const PROCESS_KEY = 'procurement.purchase-order';

  const mockSteps = [
    { id: 's1', state: 'CREATE',  label: 'Create',  sortOrder: 1, isActive: true,  isMandatory: true,  permissions: [], processId: 'p1' },
    { id: 's2', state: 'DRAFT',   label: 'Draft',   sortOrder: 2, isActive: true,  isMandatory: false, permissions: [], processId: 'p1' },
    { id: 's3', state: 'APPROVE', label: 'Approve', sortOrder: 3, isActive: true,  isMandatory: false, permissions: ['po.approve'], processId: 'p1' },
    { id: 's4', state: 'RECEIVE', label: 'Receive', sortOrder: 4, isActive: true,  isMandatory: false, permissions: ['po.receive'], processId: 'p1' },
    { id: 's5', state: 'CLOSED',  label: 'Closed',  sortOrder: 5, isActive: true,  isMandatory: true,  permissions: [], processId: 'p1' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    cache = createMockCacheService();
    events = createMockPluginEventService();

    tenantClient = prisma.getTenantClient(TENANT_SLUG);

    service = new WorkflowService(prisma, events, cache);
  });

  describe('seedProcess', () => {
    it('should upsert process and create steps', async () => {
      const steps = [
        { state: 'CREATE', label: 'Create', sortOrder: 1, isMandatory: true },
        { state: 'ACTIVE', label: 'Active', sortOrder: 2 },
      ];

      await service.seedProcess(TENANT_SLUG, 'my-plugin', 'my-plugin.items', 'Item Flow', steps);

      expect(tenantClient.workflowProcess.upsert).toHaveBeenCalledWith({
        where: { pluginKey_processKey: { pluginKey: 'my-plugin', processKey: 'my-plugin.items' } },
        update: { name: 'Item Flow' },
        create: { pluginKey: 'my-plugin', processKey: 'my-plugin.items', name: 'Item Flow' },
      });
      expect(tenantClient.workflowStep.deleteMany).toHaveBeenCalled();
      expect(tenantClient.workflowStep.createMany).toHaveBeenCalled();
      expect(cache.del).toHaveBeenCalledWith('workflow:steps:test-tenant:my-plugin.items');
    });

    it('should be idempotent on re-call', async () => {
      const steps = [{ state: 'CREATE', label: 'Create', sortOrder: 1 }];

      await service.seedProcess(TENANT_SLUG, 'my-plugin', 'my-plugin.items', 'Flow', steps);
      await service.seedProcess(TENANT_SLUG, 'my-plugin', 'my-plugin.items', 'Flow v2', steps);

      expect(tenantClient.workflowProcess.upsert).toHaveBeenCalledTimes(2);
      expect(tenantClient.workflowStep.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('getActiveSteps', () => {
    it('should return only active steps ordered by sortOrder', async () => {
      cache.get.mockResolvedValueOnce(null);
      tenantClient.workflowStep.findMany.mockResolvedValueOnce(
        mockSteps.filter((s) => s.isActive),
      );

      const steps = await service.getActiveSteps(TENANT_SLUG, PROCESS_KEY);

      expect(steps).toHaveLength(5);
      expect(steps[0].state).toBe('CREATE');
      expect(steps[4].state).toBe('CLOSED');
    });

    it('should use cache on second call', async () => {
      cache.get.mockResolvedValueOnce(null);
      tenantClient.workflowStep.findMany.mockResolvedValueOnce(mockSteps);

      await service.getActiveSteps(TENANT_SLUG, PROCESS_KEY);

      // Second call — cache should return the data
      cache.get.mockResolvedValueOnce(mockSteps);
      await service.getActiveSteps(TENANT_SLUG, PROCESS_KEY);

      expect(tenantClient.workflowStep.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNextState', () => {
    beforeEach(() => {
      cache.get.mockResolvedValue(null);
      tenantClient.workflowStep.findMany.mockResolvedValue(mockSteps);
    });

    it('should return the next active state', async () => {
      const next = await service.getNextState(TENANT_SLUG, PROCESS_KEY, 'DRAFT');
      expect(next).toBe('APPROVE');
    });

    it('should return null when at the last step', async () => {
      const next = await service.getNextState(TENANT_SLUG, PROCESS_KEY, 'CLOSED');
      expect(next).toBeNull();
    });

    it('should skip inactive steps', async () => {
      const stepsWithInactive = [
        ...mockSteps.slice(0, 2),
        { ...mockSteps[2], isActive: false }, // APPROVE inactive — but we're querying active steps only
        ...mockSteps.slice(3),
      ];
      // getActiveSteps filters by isActive, so simulating only active ones returned
      tenantClient.workflowStep.findMany.mockResolvedValue(
        stepsWithInactive.filter((s) => s.isActive),
      );

      const next = await service.getNextState(TENANT_SLUG, PROCESS_KEY, 'DRAFT');
      expect(next).toBe('RECEIVE'); // skipped APPROVE
    });
  });

  describe('getInitialState', () => {
    it('should return the first active step state', async () => {
      cache.get.mockResolvedValue(null);
      tenantClient.workflowStep.findMany.mockResolvedValue(mockSteps);

      const initial = await service.getInitialState(TENANT_SLUG, PROCESS_KEY);
      expect(initial).toBe('CREATE');
    });

    it('should throw if no active steps', async () => {
      cache.get.mockResolvedValue(null);
      tenantClient.workflowStep.findMany.mockResolvedValue([]);

      await expect(
        service.getInitialState(TENANT_SLUG, PROCESS_KEY),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('canAdvance', () => {
    beforeEach(() => {
      cache.get.mockResolvedValue(null);
      tenantClient.workflowStep.findMany.mockResolvedValue(mockSteps);
    });

    it('should return true when user has required permissions', async () => {
      const result = await service.canAdvance(TENANT_SLUG, PROCESS_KEY, 'DRAFT', ['po.approve']);
      expect(result).toBe(true);
    });

    it('should return true when next step has no permission requirements', async () => {
      const result = await service.canAdvance(TENANT_SLUG, PROCESS_KEY, 'CREATE', []);
      expect(result).toBe(true);
    });

    it('should return false when user lacks required permissions', async () => {
      const result = await service.canAdvance(TENANT_SLUG, PROCESS_KEY, 'DRAFT', ['unrelated.perm']);
      expect(result).toBe(false);
    });

    it('should return false when at the last step', async () => {
      const result = await service.canAdvance(TENANT_SLUG, PROCESS_KEY, 'CLOSED', ['any']);
      expect(result).toBe(false);
    });
  });

  describe('advance', () => {
    const entity = { id: 'po-123', status: 'DRAFT' };

    beforeEach(() => {
      cache.get.mockResolvedValue(null);
      tenantClient.workflowStep.findMany.mockResolvedValue(mockSteps);
    });

    it('should advance to next state, record transition, and emit event', async () => {
      const nextState = await service.advance(
        TENANT_SLUG, PROCESS_KEY, entity, 'user-1', ['po.approve'],
      );

      expect(nextState).toBe('APPROVE');
      expect(tenantClient.workflowTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          processKey: PROCESS_KEY,
          entityId: 'po-123',
          fromState: 'DRAFT',
          toState: 'APPROVE',
          action: 'advance',
          userId: 'user-1',
        }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        'workflow.advanced',
        expect.objectContaining({
          tenantSlug: TENANT_SLUG,
          processKey: PROCESS_KEY,
          fromState: 'DRAFT',
          toState: 'APPROVE',
        }),
      );
    });

    it('should throw ForbiddenException when user lacks permission', async () => {
      await expect(
        service.advance(TENANT_SLUG, PROCESS_KEY, entity, 'user-1', ['no.permission']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when at final step', async () => {
      const finalEntity = { id: 'po-456', status: 'CLOSED' };

      await expect(
        service.advance(TENANT_SLUG, PROCESS_KEY, finalEntity, 'user-1', []),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for unknown state', async () => {
      const badEntity = { id: 'po-789', status: 'NONEXISTENT' };

      await expect(
        service.advance(TENANT_SLUG, PROCESS_KEY, badEntity, 'user-1', []),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('toggleStep', () => {
    beforeEach(() => {
      // The proxy-based mock doesn't include findUniqueOrThrow by default
      if (!tenantClient.workflowStep.findUniqueOrThrow) {
        tenantClient.workflowStep.findUniqueOrThrow = jest.fn();
      }
    });

    it('should throw when trying to disable a mandatory step', async () => {
      tenantClient.workflowStep.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        isMandatory: true,
        label: 'Create',
        process: { processKey: PROCESS_KEY },
      });

      await expect(
        service.toggleStep(TENANT_SLUG, 's1', false),
      ).rejects.toThrow(BadRequestException);
    });

    it('should toggle and invalidate cache', async () => {
      tenantClient.workflowStep.findUniqueOrThrow.mockResolvedValue({
        id: 's2',
        isMandatory: false,
        label: 'Draft',
        process: { processKey: PROCESS_KEY },
      });
      tenantClient.workflowStep.update.mockResolvedValue({ id: 's2', isActive: false });

      const result = await service.toggleStep(TENANT_SLUG, 's2', false);

      expect(tenantClient.workflowStep.update).toHaveBeenCalledWith({
        where: { id: 's2' },
        data: { isActive: false },
      });
      expect(cache.del).toHaveBeenCalledWith(`workflow:steps:${TENANT_SLUG}:${PROCESS_KEY}`);
    });

    it('should allow enabling a mandatory step', async () => {
      tenantClient.workflowStep.findUniqueOrThrow.mockResolvedValue({
        id: 's1',
        isMandatory: true,
        label: 'Create',
        process: { processKey: PROCESS_KEY },
      });
      tenantClient.workflowStep.update.mockResolvedValue({ id: 's1', isActive: true });

      // Enabling a mandatory step should work (only disabling is blocked)
      await service.toggleStep(TENANT_SLUG, 's1', true);

      expect(tenantClient.workflowStep.update).toHaveBeenCalled();
    });
  });

  describe('recordTransition', () => {
    it('should create transition record and emit event', async () => {
      await service.recordTransition(
        TENANT_SLUG, PROCESS_KEY, 'PurchaseOrder', 'po-123',
        'APPROVE', 'REJECTED', 'reject', 'user-1', 'Budget exceeded',
      );

      expect(tenantClient.workflowTransition.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          processKey: PROCESS_KEY,
          entityId: 'po-123',
          fromState: 'APPROVE',
          toState: 'REJECTED',
          action: 'reject',
          comment: 'Budget exceeded',
        }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        'workflow.transitioned',
        expect.objectContaining({
          action: 'reject',
          fromState: 'APPROVE',
          toState: 'REJECTED',
        }),
      );
    });
  });
});
