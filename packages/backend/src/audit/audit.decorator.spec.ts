import { AUDIT_METADATA_KEY, Audit, AuditOptions } from './audit.decorator';

describe('Audit decorator', () => {
  function getMetadata(options: AuditOptions): AuditOptions | undefined {
    class TestController {
      @Audit(options)
      testMethod() {}
    }
    return Reflect.getMetadata(AUDIT_METADATA_KEY, TestController.prototype.testMethod);
  }

  it('should set metadata with default action READ', () => {
    const meta = getMetadata({ entity: 'User' });

    expect(meta).toBeDefined();
    expect(meta!.action).toBe('READ');
    expect(meta!.entity).toBe('User');
  });

  it('should allow explicit action override', () => {
    const meta = getMetadata({ entity: 'Role', action: 'CREATE' });

    expect(meta!.action).toBe('CREATE');
    expect(meta!.entity).toBe('Role');
  });

  it('should include entityId when provided', () => {
    const meta = getMetadata({ entity: 'User', entityId: 'static-id' });

    expect(meta!.entityId).toBe('static-id');
  });

  it('should not include entityId when not provided', () => {
    const meta = getMetadata({ entity: 'User' });

    expect(meta!.entityId).toBeUndefined();
  });

  it('should export the AUDIT_METADATA_KEY constant', () => {
    expect(AUDIT_METADATA_KEY).toBe('audit_metadata');
  });
});
