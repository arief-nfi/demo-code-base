import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PluginEventService } from '../events/plugin-event.service';
import { SystemEvents } from '../events/system-events';
import { CacheService } from '../cache/cache.service';
import { TenantScoped } from '../prisma/tenant-scoped.decorator';
import type { WorkflowStepSeed } from './workflow.types';

@Injectable()
@TenantScoped()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PluginEventService,
    private readonly cache: CacheService,
  ) {}

  private cacheKey(tenantSlug: string, processKey: string): string {
    return `workflow:steps:${tenantSlug}:${processKey}`;
  }

  /**
   * Seed default workflow steps when a plugin is installed for a tenant.
   * Idempotent — safe to call on re-install (deletes and recreates steps).
   */
  async seedProcess(
    tenantSlug: string,
    pluginKey: string,
    processKey: string,
    name: string,
    steps: WorkflowStepSeed[],
  ): Promise<void> {
    const client = this.prisma.getTenantClient(tenantSlug);

    const process = await client.workflowProcess.upsert({
      where: { pluginKey_processKey: { pluginKey, processKey } },
      update: { name },
      create: { pluginKey, processKey, name },
    });

    await client.workflowStep.deleteMany({ where: { processId: process.id } });
    await client.workflowStep.createMany({
      data: steps.map((s) => ({
        processId: process.id,
        state: s.state,
        label: s.label,
        sortOrder: s.sortOrder,
        isMandatory: s.isMandatory ?? false,
        permissions: s.permissions ?? [],
        metadata: s.metadata,
      })),
    });

    await this.cache.del(this.cacheKey(tenantSlug, processKey));
    this.logger.debug(`Seeded workflow "${processKey}" with ${steps.length} steps for tenant "${tenantSlug}"`);
  }

  /**
   * Get all active steps for a process, ordered by sortOrder.
   * Cached with 60s TTL.
   */
  async getActiveSteps(tenantSlug: string, processKey: string) {
    const key = this.cacheKey(tenantSlug, processKey);
    const cached = await this.cache.get<any[]>(key);
    if (cached) return cached;

    const client = this.prisma.getTenantClient(tenantSlug);
    const steps = await client.workflowStep.findMany({
      where: {
        process: { processKey },
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    await this.cache.set(key, steps, 60_000);
    return steps;
  }

  /**
   * Get the next active state after the current one.
   * Returns null if current state is the last active step.
   */
  async getNextState(
    tenantSlug: string,
    processKey: string,
    currentState: string,
  ): Promise<string | null> {
    const steps = await this.getActiveSteps(tenantSlug, processKey);
    const currentIndex = steps.findIndex((s) => s.state === currentState);
    if (currentIndex === -1 || currentIndex >= steps.length - 1) return null;
    return steps[currentIndex + 1].state;
  }

  /**
   * Get the previous active state before the current one.
   */
  async getPreviousState(
    tenantSlug: string,
    processKey: string,
    currentState: string,
  ): Promise<string | null> {
    const steps = await this.getActiveSteps(tenantSlug, processKey);
    const currentIndex = steps.findIndex((s) => s.state === currentState);
    if (currentIndex <= 0) return null;
    return steps[currentIndex - 1].state;
  }

  /**
   * Get the initial state (first active step) for a new entity.
   */
  async getInitialState(
    tenantSlug: string,
    processKey: string,
  ): Promise<string> {
    const steps = await this.getActiveSteps(tenantSlug, processKey);
    if (steps.length === 0) {
      throw new BadRequestException(
        `No active steps found for workflow "${processKey}"`,
      );
    }
    return steps[0].state;
  }

  /**
   * Check if the current user can advance this entity.
   * Returns false if no next state or user lacks permissions.
   */
  async canAdvance(
    tenantSlug: string,
    processKey: string,
    currentState: string,
    userPermissions: string[],
  ): Promise<boolean> {
    const steps = await this.getActiveSteps(tenantSlug, processKey);
    const currentIndex = steps.findIndex((s) => s.state === currentState);
    if (currentIndex === -1 || currentIndex >= steps.length - 1) return false;

    const nextStep = steps[currentIndex + 1];
    if (!nextStep.permissions || nextStep.permissions.length === 0) return true;

    return nextStep.permissions.some((p: string) =>
      userPermissions.some((up) => up.toUpperCase() === p.toUpperCase()),
    );
  }

  /**
   * Advance an entity to the next active state in the workflow.
   *
   * - Validates current state exists in workflow
   * - Checks permissions on the next step
   * - Records WorkflowTransition history
   * - Emits WORKFLOW_ADVANCED event
   * - Returns the new state (caller updates their entity)
   */
  async advance(
    tenantSlug: string,
    processKey: string,
    entity: { id: string; status: string },
    userId: string,
    userPermissions: string[],
    comment?: string,
  ): Promise<string> {
    const steps = await this.getActiveSteps(tenantSlug, processKey);
    const currentIndex = steps.findIndex((s) => s.state === entity.status);

    if (currentIndex === -1) {
      throw new BadRequestException(
        `Unknown state "${entity.status}" in workflow "${processKey}"`,
      );
    }

    if (currentIndex >= steps.length - 1) {
      throw new BadRequestException(
        `Cannot advance: entity is at the final step "${entity.status}"`,
      );
    }

    const nextStep = steps[currentIndex + 1];

    // Check permissions
    if (nextStep.permissions && nextStep.permissions.length > 0) {
      const hasPermission = nextStep.permissions.some((p: string) =>
        userPermissions.some((up) => up.toUpperCase() === p.toUpperCase()),
      );
      if (!hasPermission) {
        throw new ForbiddenException(
          `Insufficient permissions to advance to "${nextStep.state}"`,
        );
      }
    }

    // Record transition
    const client = this.prisma.getTenantClient(tenantSlug);
    await client.workflowTransition.create({
      data: {
        processKey,
        entityType: processKey,
        entityId: entity.id,
        fromState: entity.status,
        toState: nextStep.state,
        action: 'advance',
        userId,
        comment,
      },
    });

    // Emit event
    this.events.emit(SystemEvents.WORKFLOW_ADVANCED, {
      tenantSlug,
      userId,
      processKey,
      entityType: processKey,
      entityId: entity.id,
      fromState: entity.status,
      toState: nextStep.state,
      timestamp: new Date(),
    });

    return nextStep.state;
  }

  /**
   * Record a non-linear transition (REJECT, CANCEL, REVERT, etc.).
   * The plugin is responsible for validation — this method only records
   * the history and emits the event.
   */
  async recordTransition(
    tenantSlug: string,
    processKey: string,
    entityType: string,
    entityId: string,
    fromState: string,
    toState: string,
    action: string,
    userId: string,
    comment?: string,
  ): Promise<void> {
    const client = this.prisma.getTenantClient(tenantSlug);
    await client.workflowTransition.create({
      data: {
        processKey,
        entityType,
        entityId,
        fromState,
        toState,
        action,
        userId,
        comment,
      },
    });

    this.events.emit(SystemEvents.WORKFLOW_TRANSITIONED, {
      tenantSlug,
      userId,
      processKey,
      entityType,
      entityId,
      fromState,
      toState,
      action,
      comment,
      timestamp: new Date(),
    });
  }

  /**
   * Get transition history for an entity.
   */
  async getTransitionHistory(
    tenantSlug: string,
    processKey: string,
    entityId: string,
  ) {
    const client = this.prisma.getTenantClient(tenantSlug);
    return client.workflowTransition.findMany({
      where: { processKey, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Toggle a workflow step on/off for a tenant.
   * Throws if step is mandatory (isMandatory = true).
   */
  async toggleStep(tenantSlug: string, stepId: string, isActive: boolean) {
    const client = this.prisma.getTenantClient(tenantSlug);

    const step = await client.workflowStep.findUniqueOrThrow({
      where: { id: stepId },
      include: { process: { select: { processKey: true } } },
    });

    if (step.isMandatory && !isActive) {
      throw new BadRequestException(
        `Cannot disable mandatory step "${step.label}"`,
      );
    }

    const updated = await client.workflowStep.update({
      where: { id: stepId },
      data: { isActive },
    });

    // Invalidate cache
    await this.cache.del(this.cacheKey(tenantSlug, step.process.processKey));

    return updated;
  }
}
