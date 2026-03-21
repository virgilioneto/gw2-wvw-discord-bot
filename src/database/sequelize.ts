import 'dotenv/config';
import { Sequelize } from 'sequelize';

const uri = process.env.POSTGRES_URI;
if (!uri) {
  throw new Error('Defina POSTGRES_URI no ambiente');
}

export const sequelize = new Sequelize(uri, {
  dialect: 'postgres',
  logging: false,
  define: {
    underscored: true,
    timestamps: true,
  },
});
