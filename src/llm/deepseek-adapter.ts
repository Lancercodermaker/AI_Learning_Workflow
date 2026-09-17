import { createHttpAdapter, type CompletionAdapter, type HttpAdapterConfig, type HttpAdapterDependencies } from './http-adapter';

export function createDeepSeekAdapter(config: HttpAdapterConfig, dependencies: HttpAdapterDependencies = {}): CompletionAdapter {
  return createHttpAdapter({ ...config, endpointPath: '/chat/completions' }, dependencies);
}
