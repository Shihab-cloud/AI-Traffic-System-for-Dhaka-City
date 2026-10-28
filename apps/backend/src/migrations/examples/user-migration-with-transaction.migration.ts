import type { Connection } from 'mongoose';

export async function up(connection: Connection): Promise<void> {
  const session = await connection.startSession();

  await session.withTransaction(async () => {
    // 1. Analyze scope
    const affectedCount = await connection
      .collection('users')
      .countDocuments({ status: { $exists: false } }, { session });

    if (affectedCount === 0) {
      console.log('No users need migration - skipping');
      return;
    }

    // 2. Execute migration
    const result = await connection
      .collection('users')
      .updateMany(
        { status: { $exists: false } },
        { $set: { status: ['onboarding'] } },
        { session },
      );

    // 3. Validate results
    if (result.modifiedCount !== affectedCount) {
      throw new Error(
        `Migration failed: expected ${affectedCount} updates, got ${result.modifiedCount}`,
      );
    }
  });

  await session.endSession();
}

export async function down(connection: Connection): Promise<void> {
  if (!connection.db) {
    throw new Error('Database connection not available');
  }

  await connection
    .collection('users')
    .updateMany({ status: ['onboarding'] }, { $unset: { status: '' } });
}
