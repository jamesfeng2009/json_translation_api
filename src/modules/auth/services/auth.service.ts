import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EntityManager } from '@mikro-orm/core';
import * as bcrypt from 'bcrypt';
import { User, AuthProvider } from '../../user/entities/user.entity';
import { StripeService } from '../../subscription/services/stripe.service';
import { v4 as uuidv4 } from 'uuid';

interface OAuthUserData {
  email: string;
  firstName?: string;
  lastName?: string;
  provider: AuthProvider;
  providerId: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly em: EntityManager,
    private readonly jwtService: JwtService,
    private readonly stripeService: StripeService,
  ) {}

  async register(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<{ user: User; token: string }> {
    // 检查邮箱是否已存在
    const existingUser = await this.em.findOne(User, { email });
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // 创建 Stripe 客户
    const stripeCustomer = await this.stripeService.createCustomer(email);

    // 创建用户
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.em.create(User, {
      id: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      stripeCustomerId: stripeCustomer.id,
      provider: AuthProvider.LOCAL,
    });

    await this.em.persistAndFlush(user);

    // 生成 JWT token
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return { user, token };
  }

  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const user = await this.em.findOne(User, { email });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.provider !== AuthProvider.LOCAL) {
      throw new UnauthorizedException(`Please login with ${user.provider}`);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 更新最后登录时间
    user.lastLoginAt = new Date();
    await this.em.persistAndFlush(user);

    // 生成 JWT token
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return { user, token };
  }

  async findOrCreateOAuthUser(data: OAuthUserData): Promise<{ user: User; token: string }> {
    let user = await this.em.findOne(User, { email: data.email });

    if (!user) {
      // 创建 Stripe 客户
      const stripeCustomer = await this.stripeService.createCustomer(data.email);

      // 创建新用户
      user = this.em.create(User, {
        id: uuidv4(),
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        picture: data.picture,
        provider: data.provider,
        providerId: data.providerId,
        stripeCustomerId: stripeCustomer.id,
      });

      await this.em.persistAndFlush(user);
    } else if (user.provider !== data.provider) {
      // 如果用户存在但使用不同的认证方式
      throw new ConflictException(
        `Email already exists with ${user.provider} authentication`,
      );
    }

    // 更新最后登录时间
    user.lastLoginAt = new Date();
    await this.em.persistAndFlush(user);

    // 生成 JWT token
    const token = this.jwtService.sign({ sub: user.id, email: user.email });

    return { user, token };
  }

  async validateUser(id: string): Promise<User> {
    const user = await this.em.findOne(User, { id });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }
} 