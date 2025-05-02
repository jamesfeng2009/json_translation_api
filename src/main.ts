import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CustomLogger } from './common/utils/logger.service';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new CustomLogger(),
  });

  // 全局验证管道
  app.useGlobalPipes(new ValidationPipe());

  // Swagger 配置
  const config = new DocumentBuilder()
    .setTitle('JSON Translation API')
    .setDescription('API for JSON translation with Stripe payment integration')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // 全局前缀
  app.setGlobalPrefix('api/v1');

  await app.listen(3000);
}
bootstrap(); 