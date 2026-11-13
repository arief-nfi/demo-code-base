import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowService } from './workflow.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowTemplateController } from './workflow-template.controller';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [WorkflowController, WorkflowTemplateController],
  providers: [WorkflowService, WorkflowTemplateService],
  exports: [WorkflowService, WorkflowTemplateService],
})
export class WorkflowModule {}
