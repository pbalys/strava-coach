export default function Home() { return null; }
export async function getServerSideProps({ res }) {
  res.setHeader('Location', '/index.html');
  res.statusCode = 302;
  return { props: {} };
}
