import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

@Injectable()
export class PasswordService {
  private readonly saltRounds = 10;

  hash(password: string) {
    return bcrypt.hash(password, this.saltRounds);
  }

  compare(password: string, passwordHash: string) {
    return bcrypt.compare(password, passwordHash);
  }
}
