import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';

type AccessTokenPayload = {
  sub: string;
  email: string;
};

@Injectable()
export class JwtService {
  private readonly secret =
    process.env.JWT_SECRET ?? 'mafia-casefile-local-jwt-secret';

  signAccessToken(user: Pick<User, 'id' | 'email'>) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
    };

    return jwt.sign(payload, this.secret, { expiresIn: '1h' });
  }

  verifyAccessToken(token: string) {
    return jwt.verify(token, this.secret) as AccessTokenPayload;
  }
}
