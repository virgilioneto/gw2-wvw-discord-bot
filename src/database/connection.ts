import { sequelize } from './sequelize';

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
  console.log('Conectado ao PostgreSQL');
}

export async function disconnectDatabase(): Promise<void> {
  await sequelize.close();
}
