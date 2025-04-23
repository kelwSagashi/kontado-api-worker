import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import { AppEnv, Hono } from "hono";
import { main } from "seed";
import AppError from "utils/AppError";

const seedRoutes = new Hono<AppEnv>();

seedRoutes.post("/", async (c) => {
    try {
        const adapter = new PrismaD1(c.env.DB);
        const prisma = new PrismaClient({ adapter });
        await main(prisma);

        return c.json({ message: "seed finalizada!" });
    } catch (error) {
        // Re-throw AppErrors or handle other errors
        if (error instanceof AppError) throw error;
        // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
        console.error("Register Error:", error);
        throw new AppError('Erro', 500); // Default internal error
    }
});

export default seedRoutes;