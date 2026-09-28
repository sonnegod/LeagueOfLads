import { AsyncLocalStorage } from 'node:async_hooks';

const auditActor = new AsyncLocalStorage();

export function runWithAuditActor(admin, callback) {
  return auditActor.run(admin, callback);
}

export function getAuditActor() {
  return auditActor.getStore() || null;
}
