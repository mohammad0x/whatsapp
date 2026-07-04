import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { PrismaService } from '../prisma/prisma.service';
import { SuperAdminController } from '../super-admin/super-admin.controller'; 
import { SuperAdminService } from '../super-admin/super-admin.service';


@Module({
  controllers: [CrmController,SuperAdminController],
  providers: [CrmService, PrismaService,SuperAdminService],
})
export class CrmModule {}