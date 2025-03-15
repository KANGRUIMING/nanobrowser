import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uwswovzfhmegmxyccwaf.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3c3dvdnpmaG1lZ214eWNjd2FmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwMDUxNjUsImV4cCI6MjA1NzU4MTE2NX0._dbwD_rLVgXzI1ABY880TO6ty9ecHhgEXGSUkJRY4E4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export class SupabaseService {
  // Example method to fetch PDF files
  static async getPdfFiles() {
    try {
      const { data, error } = await supabase.from('parsed_resumes').select('*');

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
      const { data, error } = await supabase.from('parsed_resumes').insert([fileData]).select();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error inserting PDF file:', error);
      throw error;
    }
  }

  // Add more methods as needed for your specific use case
}
