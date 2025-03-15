import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pdpxvfgnagwgcgbnckjr.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkcHh2ZmduYWd3Z2NnYm5ja2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwMDE1NjEsImV4cCI6MjA1NzU3NzU2MX0.tz9uMHvscPphIhW0kpy9yuqYrvf9-YSEfcd89UdP03w';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export class SupabaseService {
  // Example method to fetch PDF files
  static async getPdfFiles() {
    try {
      const { data, error } = await supabase.from('pdf_files').select('*');

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching PDF files:', error);
      throw error;
    }
  }

  // Example method to insert a PDF file
  static async insertPdfFile(fileData: any) {
    try {
      const { data, error } = await supabase.from('pdf_files').insert([fileData]).select();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error inserting PDF file:', error);
      throw error;
    }
  }

  // Add more methods as needed for your specific use case
}
