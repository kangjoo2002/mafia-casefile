import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';

export type AccessTokenPayload = {
  sub: string;
  email: string;
};

function isAccessTokenPayload(payload: unknown): payload is AccessTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'sub' in payload &&
    'email' in payload &&
    typeof (payload as { sub: unknown }).sub === 'string' &&
    typeof (payload as { email: unknown }).email === 'string'
  );
}

@Injectable()
export class JwtService {
  private getSecret() {
    return process.env.JWT_SECRET ?? 'mafia-casefile-local-jwt-secret';
  }

  signAccessToken(user: Pick<User, 'id' | 'email'>) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
    };

    return jwt.sign(payload, this.getSecret(), { expiresIn: '1h' });
  }

  verifyAccessToken(token: string) {
    const payload = jwt.verify(token, this.getSecret());

    if (!isAccessTokenPayload(payload)) {
      throw new Error('Invalid access token payload');
    }

    return payload;
  }
}
