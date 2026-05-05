import type { InferAgentUIMessage } from 'ai';
import { createAgent } from './agent.js';

/** UI message type with typed tool parts (tool-edit_file, tool-read_file, ...). */
export type DesignAgentUIMessage = InferAgentUIMessage<ReturnType<typeof createAgent>>;
