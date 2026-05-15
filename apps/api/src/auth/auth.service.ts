import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { UserRepository } from '../users/user.repository';

export interface SignupInput {
  email: string;
  nickname: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

function isBlank(value: unknown) {
  return typeof value !== 'string' || value.trim().length === 0;
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(input: SignupInput) {
    if (isBlank(input?.email) || isBlank(input?.nickname) || isBlank(input?.password)) {
      throw new BadRequestException('email, nickname, and password are required');
    }

    const existingUser = await this.userRepository.findByEmail(input.email);
    if (existingUser) {
      throw new ConflictException('email already exists');
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const user = await this.userRepository.create({
      email: input.email,
      nickname: input.nickname,
      passwordHash,
    });

    return {
      user: toPublicUser(user),
      accessToken: this.jwtService.signAccessToken(user),
    };
  }

  async login(input: LoginInput) {
    if (isBlank(input?.email) || isBlank(input?.password)) {
      throw new BadRequestException('email and password are required');
    }

    const user = await this.userRepository.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    const isPasswordValid = await this.passwordService.compare(
      input.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('invalid credentials');
    }

    return {
      user: toPublicUser(user),
      accessToken: this.jwtService.signAccessToken(user),
    };
  }
}
