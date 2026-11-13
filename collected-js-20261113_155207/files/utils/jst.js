function jstDateString(now = new Date()) {
  const jstOffsetMin = 9 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const jst = new Date(utcMs + jstOffsetMin * 60000);
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, '0');
  const dd = String(jst.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // "2025-11-11"
}
module.exports = { jstDateString };
