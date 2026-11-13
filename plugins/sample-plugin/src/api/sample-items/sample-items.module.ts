import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule, ImportService } from '@saas/backend';
import { SampleItemsController } from './sample-items.controller';
import { SampleItemsService } from './sample-items.service';
import { SampleItemImportHandler } from './sample-item-import.handler';

@Module({
  imports: [PrismaModule],
  controllers: [SampleItemsController],
  providers: [SampleItemsService, SampleItemImportHandler],
  exports: [SampleItemsService],
})
export class SampleItemsModule implements OnModuleInit {
  constructor(
    private readonly importService: ImportService,
    private readonly importHandler: SampleItemImportHandler,
  ) {}

  onModuleInit() {
    this.importService.registerImport(
      {
        key: 'sample-plugin.items',
        entity: 'SampleItem',
        label: 'Sample Items',
        description: 'Import sample items from CSV or Excel',
        permissions: ['sample-plugin.item.write'],
        maxRows: 1000,
        columns: [
          { key: 'name', header: 'Name', type: 'string', required: true },
          { key: 'value', header: 'Value', type: 'string' },
        ],
      },
      this.importHandler,
    );
  }
}
