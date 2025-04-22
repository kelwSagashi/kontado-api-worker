import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "@prisma/client";
import { AppEnv, Context } from "hono";

export const getStatus = async (c: Context<AppEnv>) => {
	const adapter = new PrismaD1(c.env.DB);
	const prisma = new PrismaClient({ adapter });

	const healthCheck = {
		online: true,
		uptime: process.uptime(), // Tempo que o processo Node está rodando (em segundos)
		status: 'ok',           // Status geral inicial
		timestamp: new Date().toISOString(),
		database: 'checking',   // Status da conexão com o banco
	};

	try {
		// Tenta executar uma query muito simples para verificar a conexão com o DB
		await prisma.$queryRaw`SELECT 1`;
		healthCheck.database = 'ok';
		// Se a conexão com o DB estiver ok, retorna 200 OK
		return c.json(healthCheck, 200);
	} catch (error) {
		// Se a query falhar, indica problema no DB
		healthCheck.status = 'error'; // Muda status geral
		healthCheck.database = 'error';
		console.error('Health check database error:', error);
		// Retorna 503 Service Unavailable, indicando que um serviço essencial (DB) está fora
		return c.json(healthCheck, 503);
	}
}