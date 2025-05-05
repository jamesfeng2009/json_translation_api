import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../services/auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID'),
      clientSecret: configService.get('GITHUB_CLIENT_SECRET'),
      callbackURL: configService.get('GITHUB_CALLBACK_URL'),
      scope: ['user:email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<any> {
    const { name, emails, photos } = profile;
    const user = {
      email: emails[0].value,
      firstName: name?.givenName || profile.username,
      lastName: name?.familyName || '',
      picture: photos?.[0]?.value,
      accessToken,
    };

    // 查找或创建用户
    const existingUser = await this.authService.findOrCreateOAuthUser({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      provider: 'github',
      providerId: profile.id,
    });

    return existingUser;
  }
} 