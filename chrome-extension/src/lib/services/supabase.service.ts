import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wuszvpgeaivovcguytdj.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1c3p2cGdlYWl2b3ZjZ3V5dGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE5Nzg0MDEsImV4cCI6MjA1NzU1NDQwMX0.tUXk9MkKwkgjZPpd4Yur--dXiwuEOiz0Pf_SvJh0IyM';

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
