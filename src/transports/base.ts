/**
 * Transport Interface — platform-agnostic message handling.
 * Each transport receives messages from a platform and forwards
 * them to the orchestrator, then sends the response back.
 */

import { Orchestrator } from '../core/orchestrator';

export interface IncomingMessage {
  userId: string;
  text: string;
  platform: string;
  metadata?: Record<string, any>;
}

export abstract class Transport {
  protected orchestrator: Orchestrator;
  protected platform: string;

  constructor(orchestrator: Orchestrator, platform: string) {
    this.orchestrator = orchestrator;
    this.platform = platform;
  }

  /** Start listening for messages */
  abstract start(): Promise<void>;

  /** Stop the transport */
  abstract stop(): Promise<void>;

  /** Process an incoming message through the orchestrator */
  protected async handleMessage(msg: IncomingMessage): Promise<string> {
    return this.orchestrator.handleMessage(msg.userId, msg.text);
  }
}
