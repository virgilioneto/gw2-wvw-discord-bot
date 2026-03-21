import mongoose from 'mongoose';

export async function connectDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri, {
    family: 4,
  });
  console.log('Conectado ao MongoDB');
}
