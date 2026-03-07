import mongoose from 'mongoose';

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri);
  console.log('Conectado ao MongoDB');
}
