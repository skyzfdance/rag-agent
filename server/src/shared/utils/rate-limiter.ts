/**
 * Token Bucket 速率限制器
 *
 * 使用令牌桶算法限制每分钟的操作次数。
 * 桶以固定速率补充令牌，每次操作消耗指定数量的令牌。
 * 当令牌不足时，调用方会被阻塞直到令牌恢复。
 */
export class TokenBucket {
  /** 当前可用令牌数（可为负数，表示透支） */
  private tokens: number;
  /** 桶容量（最大令牌数） */
  private readonly capacity: number;
  /** 每毫秒补充的令牌数 */
  private readonly refillRatePerMs: number;
  /** 上次补充的时间戳 */
  private lastRefillTime: number;

  /**
   * @param maxPerMinute - 每分钟允许的最大额度
   */
  constructor(maxPerMinute: number) {
    this.capacity = maxPerMinute;
    this.tokens = maxPerMinute;
    this.refillRatePerMs = maxPerMinute / 60000;
    this.lastRefillTime = Date.now();
  }

  /**
   * 按经过时间补充令牌
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefillTime = now;
  }

  /**
   * 预扣指定数量的令牌（调用前）
   *
   * 如果当前令牌不足，会等待足够的令牌补充后再返回。
   * JavaScript 单线程保证 refill + check + deduct 在同一事件循环 tick 内原子执行，
   * 多个并发 acquire 通过 setTimeout 排队不会双扣。
   *
   * @param cost - 本次操作消耗的令牌数，默认 1
   */
  async acquire(cost = 1): Promise<void> {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return;
    }
    // 令牌不足，计算需要等待的时间
    const deficit = cost - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillRatePerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.acquire(cost);
  }

  /**
   * 后扣令牌（调用后按实际用量扣减）
   *
   * 不阻塞，直接从桶中扣减。令牌数可变为负数，
   * 负数会导致后续 acquire 调用阻塞等待补充，实现自然限流。
   *
   * @param cost - 实际消耗的令牌数
   */
  consume(cost: number): void {
    this.refill();
    this.tokens -= cost;
  }
}

/**
 * LLM 双维度速率限制器
 *
 * 同时限制 RPM（每分钟请求数）和 TPM（每分钟 token 数），
 * 任一维度触发即阻塞后续调用。
 *
 * - RPM：预扣模式，每次调用前扣 1 个令牌
 * - TPM：后扣模式，调用前检查余量（acquire(0)），调用后按实际 token 数扣减
 *
 * 由于 TPM 无法在调用前预知 token 数，采用"先放行、后扣减"策略：
 * 如果上一批调用已透支 TPM 额度，桶会变为负数，后续调用的 acquire(0)
 * 会阻塞到令牌补充至非负，实现自然限流。
 */
export class LLMRateLimiter {
  /** RPM 令牌桶 */
  private readonly rpmBucket: TokenBucket;
  /** TPM 令牌桶 */
  private readonly tpmBucket: TokenBucket;

  /**
   * @param rpm - 每分钟最大请求数
   * @param tpm - 每分钟最大 token 数
   */
  constructor(rpm: number, tpm: number) {
    this.rpmBucket = new TokenBucket(rpm);
    this.tpmBucket = new TokenBucket(tpm);
  }

  /**
   * 调用前获取许可
   *
   * 先检查 TPM 余量，再扣减 RPM，避免 TPM 阻塞期间白白消耗 RPM 预算。
   * RPM 直接扣 1；TPM 只检查余量非负（实际用量在调用后通过 reportUsage 扣减）。
   */
  async acquire(): Promise<void> {
    // 先等待 TPM 恢复，再扣 RPM，防止 TPM 阻塞时空耗 RPM 令牌
    await this.tpmBucket.acquire(0);
    await this.rpmBucket.acquire(1);
  }

  /**
   * 调用后上报实际 token 用量
   *
   * 从 TPM 桶中扣减实际消耗的 token 数。
   * 如果扣减后桶为负数，后续 acquire() 会自动阻塞等待恢复。
   *
   * @param tokens - 本次调用实际消耗的 token 数（prompt + completion）
   */
  reportUsage(tokens: number): void {
    this.tpmBucket.consume(tokens);
  }
}
