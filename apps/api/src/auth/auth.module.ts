import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule, RbacGuard } from '@saas/backend';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { UploadModule } from '../uploads/uploads.module';

@Module({
  imports: [
    PrismaModule,
    UploadModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return {
          secret,
          signOptions: {
            expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN')
            || configService.get<string>('JWT_EXPIRES_IN')
            || '15m',
          } as JwtSignOptions,
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, JwtStrategy, RbacGuard],
  controllers: [AuthController],
  exports: [AuthService, RbacGuard],
})
export class AuthModule {}
