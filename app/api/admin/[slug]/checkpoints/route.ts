import { adminRoute } from '@/lib/admin/server';

export const GET = adminRoute('listCheckpoints');
export const POST = adminRoute('createCheckpoint');
