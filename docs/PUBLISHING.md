<h1 align="center" dir="rtl">انتشار README و آموزش در GitHub</h1>

<div dir="rtl">

صفحهٔ آموزش: **[https://amyraxvpn-main.github.io/Amyrax-Panel/](https://amyraxvpn-main.github.io/Amyrax-Panel/)**


README، تیتر متحرک، کاور و ویدئو از مسیرهای داخل همین پروژه استفاده می‌کنند. پوشهٔ `docs` را همراه `README.md` و فایل‌های کد در ریشهٔ مخزن قرار دهید. برای آماده‌کردن بستهٔ انتشار، می‌توانید از `scripts/package-github.py` استفاده کنید.

<h2 align="center" dir="rtl">پخش مستقیم در صفحهٔ README</h2>

GitHub تگ `<video>` با مسیر محلی را در README پخش نمی‌کند. برای ساخت پخش‌کنندهٔ خود GitHub:

1. فایل `README.md` را در GitHub باز کنید و **Edit** را بزنید.
2. در بخش «آموزش ویدئویی راه‌اندازی»، زیر کاور یک خط خالی ایجاد کنید.
3. فایل `docs/media/setup.mp4` را از همین پروژه در ویرایشگر **Drag & Drop** کنید و صبر کنید بارگذاری کامل شود.
4. GitHub یک نشانی با آغاز `https://github.com/user-attachments/assets/` می‌سازد. نشانی را در یک خط مستقل نگه دارید؛ آن را داخل کد، لینک Markdown یا تگ تصویر قرار ندهید.
5. در **Preview** پخش‌کننده را بررسی کنید و تغییر README را ذخیره کنید.

این روش به خرید سرویس ویدئو یا آپلود در سایت دیگری نیاز ندارد. فایل کم‌حجم آماده شده است تا در محدودیت **۱۰ MB** پیوست ویدئو برای مخزن‌های طرح رایگان GitHub جا بگیرد. [راهنمای رسمی پیوست‌های GitHub](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).

کاور و لینک فایل مخزن همچنان کار می‌کنند؛ پخش‌کنندهٔ خود GitHub بعد از دریافت نشانی پیوست فعال می‌شود. نشانی پیوست را نمی‌توان پیش از بارگذاری ویدئو در GitHub از مسیر ویندوز ساخت.

<h2 align="center" dir="rtl">صفحهٔ آموزش با پخش از همان فایل پروژه</h2>

فایل `docs/index.html` یک صفحهٔ آموزش آماده با پخش‌کننده، راهنمای نصب و لینک‌های هاست و کانال است. MP4 و همهٔ فایل‌های مورد استفادهٔ آن داخل پروژه قرار دارند.

برای نمایش روی **GitHub Pages**:

1. در مخزن به **Settings → Pages** بروید.
2. در **Source** گزینهٔ **Deploy from a branch** را انتخاب کنید.
3. شاخهٔ حاوی فایل‌ها را انتخاب و پوشه را روی **/docs** بگذارید؛ سپس **Save** کنید.
4. پس از انتشار، آدرس واقعی سایت را از همان صفحه بگیرید. می‌توانید آن را به بخش آموزش README اضافه کنید.

در این صفحه، پخش ویدئو مستقیم از `media/setup.mp4` انجام می‌شود. فعال‌کردن Pages یک سایت عمومی جدا از رابط README ایجاد می‌کند؛ کد Node.js پنل با GitHub Pages اجرا نمی‌شود.

<h2 align="center" dir="rtl">فایل‌های رسانه</h2>

<table align="center" dir="rtl">
  <thead>
    <tr><th align="right">فایل</th><th align="right">کاربرد</th></tr>
  </thead>
  <tbody>
    <tr><td align="right"><code>media/setup.mp4</code></td><td align="right">نسخهٔ کامل آموزش با حجم مناسب انتشار و پخش در مرورگر</td></tr>
    <tr><td align="right"><code>media/Video-original.mp4</code></td><td align="right">کپی اصلی ویدئو، برای نگهداری محلی؛ از بستهٔ GitHub و Git خارج شده است</td></tr>
    <tr><td align="right"><code>media/tutorial-cover.png</code></td><td align="right">کاور آموزش</td></tr>
    <tr><td align="right"><code>media/hero.gif</code></td><td align="right">تیتر متحرک README</td></tr>
    <tr><td align="right"><code>media/hero.png</code></td><td align="right">نسخهٔ ثابت برای حالت کاهش حرکت</td></tr>
    <tr><td align="right"><code>media/panel-preview.png</code></td><td align="right">نمای پنل با دادهٔ آزمایشی</td></tr>
  </tbody>
</table>

بستهٔ GitHub شامل کد، README، صفحهٔ آموزش و نسخهٔ سبک‌تر کامل ویدئو است. فایل اصلی محلی حذف یا ویرایش نشده است. فایل‌های اطلاعات واقعی کاربران و پوشهٔ `.review` وارد بسته نمی‌شوند.

</div>
