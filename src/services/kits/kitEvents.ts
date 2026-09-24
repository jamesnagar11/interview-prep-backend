import { EventEmitter } from 'node:events';

export const kitEvents = new EventEmitter();
kitEvents.setMaxListeners(0);
