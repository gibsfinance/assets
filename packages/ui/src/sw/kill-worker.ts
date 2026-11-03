/**
 * Kill switch. Building with `VITE_SERVICE_WORKER=off` ships this text as `/sw.js`
 * in place of the real worker, and stops the page from registering a worker at all.
 * Every browser that already holds the real worker checks `/sw.js` for a change, finds
 * this one, runs it, and it deletes every cache and unregisters itself. After that,
 * pages load from the network as they did before the worker existed.
 */
export const killWorkerSource = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',(event)=>{event.waitUntil((async()=>{for(const name of await caches.keys())await caches.delete(name);await self.registration.unregister()})())});`
