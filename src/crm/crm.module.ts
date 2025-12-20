import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CrmController],
  providers: [CrmService, PrismaService],
})
export class CrmModule {}