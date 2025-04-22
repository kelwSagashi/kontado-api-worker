// src/utils/AppError.ts
class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean; // Flag to distinguish operational vs programmer errors
  declare public errors: {
    path: string;
    message: string;
  }[]

  constructor(message: string, statusCode: number) {
    super(message); // Call parent constructor (Error)

    this.statusCode = statusCode;
    // Determine if it's an operational error (predictable, like user input error)
    // or a programmer error (bug, unexpected issue)
    this.isOperational = `${statusCode}`.startsWith('4'); // Errors starting with 4xx are generally operational

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);

    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export default AppError;