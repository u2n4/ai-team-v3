'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whitelisted discussion events the renderer may subscribe to. The listener only
// receives the event payload (never the raw IpcRendererEvent), so the renderer cannot
// reach back into ipcRenderer. onDiscussionEvent returns an unsubscribe function.
const subscriptions = new Set();
window.addEventListener('pagehide', () => { for (const unsubscribe of subscriptions) unsubscribe(); }, { once: true });

const DISCUSSION_EVENTS = ['discussion:turn', 'discussion:status', 'discussion:done'];

contextBridge.exposeInMainWorld('aiTeamV3', {
  getDashboardState: () => ipcRenderer.invoke('dashboard:state'),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  openProvider: (providerId, approval) => ipcRenderer.invoke('provider:open', providerId, approval),
  startDiscussion: (options) => ipcRenderer.invoke('discussion:start', options),
  onDiscussionEvent: (channel, handler) => {
    if (!DISCUSSION_EVENTS.includes(channel) || typeof handler !== 'function') {
      return () => {};
    }
    const wrapped = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, wrapped);
    const unsubscribe = () => { ipcRenderer.removeListener(channel, wrapped); subscriptions.delete(unsubscribe); };
    subscriptions.add(unsubscribe);
    return unsubscribe;
  }
});
