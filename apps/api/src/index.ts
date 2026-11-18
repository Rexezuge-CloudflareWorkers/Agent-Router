import { AgentRouterWorker } from './workers/AgentRouterWorker';

const worker = new AgentRouterWorker();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => worker.fetch(request, env, ctx),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => worker.scheduled(event, env, ctx),
};

export { CronTasksWorker } from '@agent-router/background';
export { ProxyGateway } from './workers/ProxyGateway';
