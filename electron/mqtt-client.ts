/**
 * MqttClient — MQTT 任务入口 + 结果出口 (v3)
 *
 * 职责：订阅 workflow/tasks/new 接收外部任务，
 *       发布 workflow/results/{taskId} 输出结果。
 * 不参与工作流内部逻辑——只是入口和出口。
 */

import * as mqtt from 'mqtt';
import { EventEmitter } from 'events';

export interface MqttTask {
  id: string;
  title: string;
  description: string;
  priority?: 'low' | 'normal' | 'high';
  source?: string;
  receivedAt: string;
}

export class MqttClient extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  brokerUrl: string;

  constructor(brokerUrl: string = 'mqtt://localhost:1883') {
    super();
    this.brokerUrl = brokerUrl;
  }

  connect(brokerUrl?: string): Promise<void> {
    if (brokerUrl) this.brokerUrl = brokerUrl;

    return new Promise((resolve, reject) => {
      try {
        this.client = mqtt.connect(this.brokerUrl);

        this.client.on('connect', () => {
          this.connected = true;
          this.emit('connected');

          // 订阅任务主题
          this.client?.subscribe('workflow/tasks/new', (err) => {
            if (err) {
              console.error('[MQTT] subscribe error:', err);
            } else {
              console.log('[MQTT] subscribed to workflow/tasks/new');
            }
          });
          resolve();
        });

        this.client.on('message', (topic: string, payload: Buffer) => {
          if (topic === 'workflow/tasks/new') {
            try {
              const task: MqttTask = JSON.parse(payload.toString());
              task.receivedAt = new Date().toISOString();
              this.emit('task', task);
            } catch {
              console.error('[MQTT] failed to parse task payload');
            }
          }
        });

        this.client.on('error', (err: Error) => {
          console.error('[MQTT] error:', err.message);
          this.emit('error', err);
          reject(err);
        });

        this.client.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  publishResult(taskId: string, data: object): void {
    if (!this.client || !this.connected) return;
    const topic = `workflow/results/${taskId}`;
    this.client.publish(
      topic,
      JSON.stringify({
        taskId,
        timestamp: new Date().toISOString(),
        ...data,
      }),
    );
  }

  publishRoundResult(taskId: string, round: number, data: object): void {
    this.publishResult(taskId, { round, ...data });
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// EventEmitter type declarations
export interface MqttClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'task', listener: (task: MqttTask) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}
