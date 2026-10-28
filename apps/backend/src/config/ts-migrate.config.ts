export default {
  uri: process.env.DATABASE_URL ?? '',
  collection: 'migrations',
  migrationsPath: './src/migrations',
  autosync: true,
};
