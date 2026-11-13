import { PluginMetricsInterceptor } from '../plugin-metrics.interceptor';
import { PLUGIN_KEY_METADATA } from '../plugin-key.decorator';
import { of, throwError } from 'rxjs';

describe('PluginMetricsInterceptor', () => {
  let interceptor: PluginMetricsInterceptor;
  let mockReflector: { get: jest.Mock };
  let mockMetrics: { record: jest.Mock };

  beforeEach(() => {
    mockReflector = { get: jest.fn() };
    mockMetrics = { record: jest.fn() };
    interceptor = new PluginMetricsInterceptor(mockReflector as any, mockMetrics as any);
  });

  function createContext(method: string, url: string, controllerClass: any = class {}) {
    return {
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => ({ method, url }),
      }),
    } as any;
  }

  function createHandler(response?: any) {
    return { handle: () => of(response ?? { data: 'ok' }) };
  }

  function createErrorHandler(error: Error) {
    return { handle: () => throwError(() => error) };
  }

  it('should skip non-plugin routes', (done) => {
    mockReflector.get.mockReturnValue(undefined);
    const context = createContext('GET', '/health');
    const handler = createHandler();

    interceptor.intercept(context, handler).subscribe({
      next: () => {
        expect(mockMetrics.record).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('should record metrics for plugin routes', (done) => {
    mockReflector.get.mockReturnValue('audit-log');
    const context = createContext('GET', '/plugins/audit-log');
    const handler = createHandler();

    interceptor.intercept(context, handler).subscribe({
      next: () => {
        expect(mockMetrics.record).toHaveBeenCalledWith(
          'audit-log',
          'GET /plugins/audit-log',
          expect.any(Number),
        );
        done();
      },
    });
  });

  it('should record error metrics on failure', (done) => {
    mockReflector.get.mockReturnValue('audit-log');
    const context = createContext('POST', '/plugins/audit-log');
    const error = new Error('Internal error');
    const handler = createErrorHandler(error);

    interceptor.intercept(context, handler).subscribe({
      error: (err) => {
        expect(err).toBe(error);
        expect(mockMetrics.record).toHaveBeenCalledWith(
          'audit-log',
          'POST /plugins/audit-log',
          expect.any(Number),
          error,
        );
        done();
      },
    });
  });

  it('should use PLUGIN_KEY_METADATA to get plugin key', () => {
    mockReflector.get.mockReturnValue(undefined);
    const context = createContext('GET', '/test');
    const handler = createHandler();

    interceptor.intercept(context, handler);

    expect(mockReflector.get).toHaveBeenCalledWith(PLUGIN_KEY_METADATA, expect.any(Function));
  });
});
