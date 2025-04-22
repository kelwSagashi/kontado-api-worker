// src/middlewares/error.handler.ts (Now an error handler setup function)
import { Hono, Context } from 'hono';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken'; // Keep if verifyToken throws these
import AppError from '../utils/AppError';

// --- Helper Functions (keep these, they are framework agnostic) ---

const handleZodError = (err: ZodError): AppError => {
    const errors = err.errors.map(e => ({ path: e.path.join('.'), message: e.message }));
    const message = `Erro de validação. ${errors.length > 0 ? errors[0].message : ''}`;
    const appError = new AppError(message, 400);
    appError.errors = errors;
    return appError;
};

const handlePrismaKnownError = (err: Prisma.PrismaClientKnownRequestError): AppError => {
    // ... (keep the same logic as in your original file) ...
    let message = 'Ocorreu um erro no banco de dados.';
    let statusCode = 500;

    switch (err.code) {
        case 'P2002':
            const target = (err.meta?.target as string[])?.join(', ') || 'campo(s)';
            message = `Já existe um registro com este valor para ${target}.`;
            statusCode = 409;
            break;
        case 'P2014':
        case 'P2003':
            message = 'Não é possível realizar esta operação pois existem dados relacionados.';
            statusCode = 409;
            break;
        case 'P2025':
            message = 'O registro que você tentou operar não foi encontrado.';
            statusCode = 404;
            break;
        default:
            console.error("Unhandled Prisma Known Error:", err);
            message = 'Erro inesperado no banco de dados.';
            statusCode = 500;
            break;
    }
    return new AppError(message, statusCode);
};

const handleJWTError = (err: Error): AppError => {
    let message = 'Token inválido. Por favor, faça login novamente.';
    if (err instanceof TokenExpiredError) {
        message = 'Sua sessão expirou! Por favor, faça login novamente.';
    } else if (err instanceof JsonWebTokenError) {
        // Keep specific JWT error messages if helpful, otherwise use generic
        message = `Token inválido (${err.message}). Por favor, faça login novamente.`;
    }
    return new AppError(message, 401); // Unauthorized
};


// --- Hono Error Handler Function ---

export const honoErrorHandler = (err: Error, c: Context) => {
    console.error('💥 ERROR Handler Caught:', err); // Log the original error first

    let error = err; // Assign to a mutable variable

    // Process known error types into AppError instances
    if (error instanceof ZodError) {
        error = handleZodError(error);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
        error = handlePrismaKnownError(error);
    } else if (error instanceof TokenExpiredError || error instanceof JsonWebTokenError) {
        // Catch JWT errors that might be thrown from protect middleware
        error = handleJWTError(error);
    } else if (!(error instanceof AppError)) {
        // If it's not a known type or already an AppError, wrap it
        // This catches programming errors or unhandled exceptions
        const unknownError = new AppError(error.message || 'Erro desconhecido', 500);
        unknownError.stack = error.stack; // Preserve original stack
        error = unknownError; // Now treat it as an AppError for response formatting
    }

    // Now, 'error' is guaranteed to be an instance of AppError or a subclass
    const appError = error as AppError; // Type assertion for clarity
    const statusCode = appError.statusCode || 500;

    const responseBody: {
        status: string | number,
        message: string,
        errors?: {path: string, message: string}[],
        stack?: string
    } = {
        status: appError.statusCode || (statusCode >= 500 ? 'error' : 'fail'),
        message: appError.message,
    };

    // Include specific errors (like validation) if they exist
    if (appError.errors) {
        responseBody.errors = appError.errors;
    }

    // Include stack trace only in development
    if (process.env.NODE_ENV === 'development' && appError.stack) {
        responseBody.stack = appError.stack;
    }

    // Send the JSON response using Hono context
    return c.json(responseBody, { status: statusCode as any });
};