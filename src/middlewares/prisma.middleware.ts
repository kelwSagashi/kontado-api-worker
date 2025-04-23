// src/middlewares/prisma.middleware.ts
import { AppEnv, MiddlewareHandler } from 'hono';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

/**
 * Hono middleware to initialize PrismaClient with D1 adapter
 * and attach it to the context as c.var.prisma (accessible via c.get('prisma')).
 */
export const prismaMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    // Check if prisma is already initialized on this request context
    if (c.get('prisma')) {
        await next();
        return;
    }

    try {
        // Ensure the DB binding exists in the environment
        if (!c.env.DB) {
            console.error("FATAL: D1 Database binding (DB) not found in environment.");
            throw new Error("Database configuration error."); // Throw to be caught by global error handler
        }

        // Initialize Prisma Client for this request
        const adapter = new PrismaD1(c.env.DB);
        const prisma = new PrismaClient({ adapter });
        

        // Set the prisma instance on the context variables
        c.set('prisma', prisma);

        // Proceed to the next middleware or route handler
        await next();

    } catch (error) {
        console.error("Error initializing Prisma client in middleware:", error);
        // Let the global error handler manage the response
        // Re-throwing is often appropriate for initialization errors
        throw new Error("Failed to initialize database connection.");
    }

    // Note: PrismaClient with serverless adapters like PrismaD1 generally doesn't
    // require explicit disconnection (`prisma.$disconnect()`) per request.
    // The connection lifecycle is managed by the adapter and the platform.
};