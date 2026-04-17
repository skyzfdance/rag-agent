/**
 * 自定义应用错误类
 *
 * 区分可预见的业务错误（operational）和不可预见的程序错误，
 * 便于全局错误处理中间件做差异化处理
 */
export class AppError extends Error {
  /** HTTP 状态码 */
  public readonly statusCode: number;

  /**
   * 是否为可预见的业务错误
   *
   * - true: 业务逻辑中主动抛出的错误（如参数校验失败、资源不存在），可安全返回给客户端
   * - false: 不可预见的程序错误（如数据库连接断开），需记录日志并返回通用错误信息
   */
  public readonly isOperational: boolean;

  /**
   * 创建自定义应用错误
   * @param message - 错误描述信息
   * @param statusCode - HTTP 状态码，默认 500
   * @param isOperational - 是否为可预见的业务错误，默认 true
   */
  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // 确保 instanceof 检查正常工作（TypeScript 继承 Error 的已知问题）
    Object.setPrototypeOf(this, new.target.prototype);

    // 捕获错误堆栈，排除构造函数本身
    Error.captureStackTrace(this, this.constructor);
  }
}
