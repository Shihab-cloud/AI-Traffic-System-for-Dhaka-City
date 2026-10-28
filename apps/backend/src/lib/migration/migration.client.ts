import { Migrator } from 'ts-migrate-mongoose';
import config from 'src/config/ts-migrate.config';

export class MigrationClient {
  static async run() {
    const migrator = await Migrator.connect({ ...config });

    try {
      console.info(`\n--- Running migrations ---\n`);
      const list = await migrator.list();
      console.log(`Found ${list.length} migrations`, list);

      // Down migrations for debugging only.
      const downMigrationResults = await migrator.run('down');
      for (const migration of downMigrationResults) {
        console.info('🔽 Down:', migration.filename);
      }

      // Up migrations
      const upMigrationResults = await migrator.run('up');

      await migrator.prune();

      for (const migration of upMigrationResults) {
        console.info('🔼 Up:', migration.filename);
      }

      console.log(`\n--- Migrations completed ---\n`);
    } catch (error) {
      console.error('❌ Migration failed:', error);

      // Optionally run rollback for failed migration
      // await migrator.run('down', failedMigrationName);

      throw error;
    } finally {
      await migrator.close();
    }
  }
}
