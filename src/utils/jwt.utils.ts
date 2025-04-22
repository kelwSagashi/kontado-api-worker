import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
const expiresIn = process.env.JWT_EXPIRES_IN || '1h';

if (!secret) {
  throw new Error('JWT_SECRET não está definido nas variáveis de ambiente!');
}

interface JwtPayload {
  userId: string;
  roleId: string;
  // Adicione outros dados que você queira no payload (ex: username, roles)
  // Mas mantenha o payload pequeno!
}

export const generateToken = (payload: JwtPayload): string => {
    return jwt.sign(payload, secret!, { expiresIn: expiresIn } as jwt.SignOptions);
};

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    // O tipo é inferido, mas podemos forçar se necessário
    return jwt.verify(token, secret!) as JwtPayload;
  } catch (error) {
    // Token inválido (expirado, assinatura errada, etc.)
    console.error('Erro ao verificar token JWT:', error);
    return null;
  }
};