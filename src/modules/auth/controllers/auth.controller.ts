import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from '../services/auth.service';
import { Response } from 'express';

class RegisterDto {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

class LoginDto {
  email: string;
  password: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '注册新用户' })
  @ApiResponse({ status: 201, description: '用户注册成功' })
  @ApiResponse({ status: 409, description: '邮箱已存在' })
  async register(@Body() registerDto: RegisterDto) {
    const { user, token } = await this.authService.register(
      registerDto.email,
      registerDto.password,
      registerDto.firstName,
      registerDto.lastName,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      token,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, description: '登录成功' })
  @ApiResponse({ status: 401, description: '无效的凭证' })
  async login(@Body() loginDto: LoginDto) {
    const { user, token } = await this.authService.login(
      loginDto.email,
      loginDto.password,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      token,
    };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth 登录' })
  async googleAuth() {
    // 这个路由会重定向到 Google 登录页面
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth 回调' })
  async googleAuthCallback(@Req() req: any, @Res() res: Response) {
    const { user, token } = req.user;
    
    // 重定向到前端，带上 token
    res.redirect(`${process.env.FRONTEND_URL}/oauth-callback?token=${token}`);
  }

  @Get('github')
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth 登录' })
  async githubAuth() {
    // 这个路由会重定向到 GitHub 登录页面
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  @ApiOperation({ summary: 'GitHub OAuth 回调' })
  async githubAuthCallback(@Req() req: any, @Res() res: Response) {
    const { user, token } = req.user;
    
    // 重定向到前端，带上 token
    res.redirect(`${process.env.FRONTEND_URL}/oauth-callback?token=${token}`);
  }
} 