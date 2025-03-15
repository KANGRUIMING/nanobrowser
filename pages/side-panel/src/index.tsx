import { createRoot } from 'react-dom/client';
import '@src/index.css';
import SidePanel from '@src/SidePanel';

function init() {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(<SidePanel />);
}

const SUPABASE_URL = 'https://pdpxvfgnagwgcgbnckjr.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkcHh2ZmduYWd3Z2NnYm5ja2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwMDE1NjEsImV4cCI6MjA1NzU3NzU2MX0.tz9uMHvscPphIhW0kpy9yuqYrvf9-YSEfcd89UdP03w';

init();
