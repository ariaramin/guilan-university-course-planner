<p align="center">
  <img src="./thumbnail.png" alt="نمای افزونه برنامه‌ریز انتخاب واحد دانشگاه گیلان" />
</p>

<h1 align="center" dir="rtl">برنامه‌ریز انتخاب واحد دانشگاه گیلان</h1>

<p align="center" dir="rtl">
  افزونه‌ای محلی برای خواندن دروس ارائه‌شده در سامانه
  سادا،
  تطبیق چارت درسی و ساخت برنامه‌های بدون تداخل کلاسی و امتحانی.
</p>

<p align="center" dir="ltr">
  <a href="./extension/manifest.json">
    <img src="https://img.shields.io/badge/version-1.0.0-0969da" alt="Version 1.0.0" />
  </a>
  <a href="./extension/manifest.json">
    <img src="https://img.shields.io/badge/Manifest-V3-2ea44f" alt="Chrome Manifest V3" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-f2c744" alt="MIT License" />
  </a>
</p>

<h2 dir="rtl">✨ معرفی</h2>

<p dir="rtl">
  <strong>برنامه‌ریز انتخاب واحد دانشگاه گیلان</strong>
  یک افزونه
  <span dir="ltr">Chrome</span>
  برای ساده‌تر کردن بررسی دروس ارائه‌شده در سامانه
  سادا
  است. افزونه جدول فعلی دروس را از صفحه باز سامانه می‌خواند، امکان تطبیق آن با فایل چارت درسی را فراهم می‌کند، درس‌های پاس‌شده را دستی یا از کارنامه ترمی می‌خواند و بر اساس محدودیت‌ها و ترجیح‌های کاربر، برنامه‌های پیشنهادی می‌سازد.
</p>

<blockquote dir="rtl">
  <strong>مهم:</strong>
  این پروژه مستقل است و وابستگی رسمی به دانشگاه گیلان ندارد.
</blockquote>

<h2 dir="rtl">🧩 قابلیت‌ها</h2>

<table dir="rtl" align="center" width="1000">
  <colgroup>
    <col width="240" />
    <col width="760" />
  </colgroup>
<thead>
    <tr>
      <th dir="rtl" align="right" width="240">قابلیت</th>
      <th dir="rtl" align="right" width="760">توضیح</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td dir="rtl" align="right" width="240">دریافت دروس</td>
      <td dir="rtl" align="right" width="760">
        خواندن جدول فعلی و قابل‌مشاهده دروس از دامنه
        <code dir="ltr">sada.guilan.ac.ir</code>
      </td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">تطبیق چارت</td>
      <td dir="rtl" align="right" width="760">
        پردازش فایل
        <code dir="ltr">DOCX</code>،
        تطبیق درس‌ها و بازبینی موارد مبهم
      </td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">جست‌وجو و فیلتر</td>
      <td dir="rtl" align="right" width="760">فیلتر بر اساس نام درس، استاد، روز، مقطع، ترم، واحد، جنسیت، ظرفیت و وضعیت چارت</td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">ساخت برنامه</td>
      <td dir="rtl" align="right" width="760">پیشنهاد برنامه با جلوگیری از تداخل کلاس و امتحان</td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">کنترل انتخاب‌ها</td>
      <td dir="rtl" align="right" width="760">تعیین گروه‌های اجباری، ترجیحی یا حذف‌شده و ثبت درس‌های گذرانده‌شده</td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">مقایسه برنامه‌ها</td>
      <td dir="rtl" align="right" width="760">مقایسه هم‌زمان حداکثر دو برنامه پیشنهادی</td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">خروجی PDF</td>
      <td dir="rtl" align="right" width="760">
        آماده‌سازی نسخه
        <span dir="ltr">A4</span>
        از طریق پنجره چاپ
        <span dir="ltr">Chrome</span>
        و گزینه
        <strong dir="ltr">Save as PDF</strong>
      </td>
    </tr>
    <tr>
      <td dir="rtl" align="right" width="240">پردازش محلی</td>
      <td dir="rtl" align="right" width="760">
        پردازش داده‌ها و فایل چارت در مرورگر، بدون اتصال به
        <span dir="ltr">API</span>
        یا سرور خارجی
      </td>
    </tr>
  </tbody>
</table>

<h2 dir="rtl">🚀 شروع سریع</h2>

<p dir="rtl">
  برای استفاده از نسخه فعلی، مخزن را دریافت کنید و پوشه
  <code dir="ltr">extension</code>
  را مستقیماً در
  <span dir="ltr">Chrome</span>
  بارگذاری کنید. پروژه مرحله
  <span dir="ltr">build</span>
  جداگانه‌ای ندارد.
</p>

<h3 dir="rtl">نصب از سورس</h3>

<ol dir="rtl">
  <li>
    مخزن را
    <span dir="ltr">Clone</span>
    کنید:
  </li>
</ol>

<pre dir="ltr"><code class="language-bash">git clone https://github.com/ariaramin/guilan-university-course-scheduler.git
cd guilan-university-course-scheduler</code></pre>

<p dir="rtl">
  یا از منوی
  <strong dir="ltr">Code → Download ZIP</strong>
  در
  <span dir="ltr">GitHub</span>،
  سورس پروژه را دانلود و استخراج کنید.
</p>

<ol dir="rtl" start="2">
  <li>
    در
    <span dir="ltr">Chrome</span>
    آدرس زیر را باز کنید:
  </li>
</ol>

<pre dir="ltr"><code>chrome://extensions</code></pre>

<ol dir="rtl" start="3">
  <li>
    گزینه
    <strong dir="ltr">Developer mode</strong>
    را فعال کنید.
  </li>
  <li>
    روی
    <strong dir="ltr">Load unpacked</strong>
    کلیک کنید.
  </li>
  <li>پوشه زیر را انتخاب کنید:</li>
</ol>

<pre dir="ltr"><code>extension/</code></pre>

<ol dir="rtl" start="6">
  <li>
    صفحه فهرست دروس در سامانه
    سادا
    را باز یا بازخوانی کنید و سپس روی آیکن افزونه کلیک کنید.
  </li>
</ol>

<blockquote dir="rtl">
  <strong>نکته:</strong>
  در حال حاضر
  <span dir="ltr">Release</span>
  عمومی در مخزن منتشر نشده است؛ بنابراین نصب از سورس روش قابل‌تأیید پروژه است.
</blockquote>

<h2 dir="rtl">🧭 راهنمای استفاده</h2>

<ol dir="rtl">
  <li>
    وارد سامانه
    سادا
    شوید و صفحه‌ای را باز کنید که جدول دروس ارائه‌شده در آن نمایش داده می‌شود.
  </li>
  <li>روی آیکن افزونه کلیک کنید تا صفحه برنامه‌ریز باز شود.</li>
  <li>وضعیت دریافت داده را بررسی کنید؛ افزونه فقط جدول فعلی و قابل‌مشاهده صفحه را می‌خواند.</li>
  <li>
    در صورت نیاز، فایل چارت درسی با فرمت
    <code dir="ltr">DOCX</code>
    را بارگذاری و موارد شناسایی‌شده را بازبینی کنید.
  </li>
  <li>واحد هدف، تعداد درس و فیلترهای موردنظر را تنظیم کنید.</li>
  <li>در بخش «درس‌های گذرانده‌شده»، نام درس را دستی ثبت کنید یا با بازبودن «کارنامه ترمی ← دروس ترمی» دکمه استخراج را بزنید؛ نمره‌های زیر ۱۰ نادیده گرفته می‌شوند.</li>
  <li>برنامه‌های پیشنهادی را بررسی یا حداکثر دو مورد را مقایسه کنید.</li>
  <li>
    برای دریافت
    <span dir="ltr">PDF</span>،
    روی <strong>دانلود PDF</strong> بزنید و در پنجره چاپ
    <span dir="ltr">Chrome</span>
    گزینه
    <strong dir="ltr">Save as PDF</strong>
    را انتخاب کنید.
  </li>
</ol>

<h3 dir="rtl">درس‌های گذرانده‌شده</h3>

<ol dir="rtl">
  <li>در تب اصلی سادا، <strong>کارنامه ترمی</strong> را باز کنید و بخش <strong>دروس ترمی</strong> را نمایش دهید.</li>
  <li>در برنامه‌ریز، بخش «درس‌های گذرانده‌شده» را باز و «استخراج از کارنامهٔ باز» را انتخاب کنید.</li>
  <li>فقط درس‌های دارای نمرهٔ عددی ۱۰ یا بیشتر ثبت می‌شوند؛ واحد، مجموع ستون‌های نظری، عملی و کارگاهی است.</li>
  <li>برای اصلاح یا افزودن موردی، نام درس را دستی وارد کنید؛ کد و واحد اختیاری‌اند.</li>
</ol>

<p dir="rtl">
در نسخهٔ جدید افزونه، ابتدا افزونه را در <code dir="ltr">chrome://extensions</code> Reload و سپس صفحهٔ سادا را بازخوانی کنید؛ در غیر این صورت افزونه صریحاً نسخهٔ قدیمی صفحه را گزارش می‌کند.
</p>

<h3 dir="rtl">محدودیت فایل چارت</h3>

<ul dir="rtl">
  <li>
    فرمت پیشنهادی و قابل‌پردازش:
    <code dir="ltr">DOCX</code>
  </li>
  <li>
    حداکثر حجم:
    <code dir="ltr">20 MB</code>
  </li>
  <li>
    فایل قدیمی
    <code dir="ltr">DOC</code>
    باید ابتدا به
    <code dir="ltr">DOCX</code>
    تبدیل شود.
  </li>
  <li>
    فایل‌های
    <code dir="ltr">PDF</code>،
    <span dir="ltr">Spreadsheet</span>
    و متن آزاد به‌عنوان ورودی چارت پشتیبانی نمی‌شوند.
  </li>
</ul>

<h2 dir="rtl">🛠️ توسعه</h2>

<p dir="rtl">
  پروژه با
  <span dir="ltr">JavaScript</span>
  ماژولار و
  <span dir="ltr">Chrome Extension Manifest V3 APIs</span>
  پیاده‌سازی شده است. وابستگی‌ها با
  <code dir="ltr">npm</code>
  مدیریت می‌شوند، اما فایل‌های پوشه
  <code dir="ltr">extension</code>
  بدون
  <span dir="ltr">build</span>
  جداگانه قابل‌بارگذاری هستند.
</p>

<h3 dir="rtl">پیش‌نیازها</h3>

<ul dir="rtl">
  <li>
    <span dir="ltr">Node.js 20</span>
    برای هماهنگی با
    <span dir="ltr">CI</span>
  </li>
  <li><code dir="ltr">npm</code></li>
  <li>
    <span dir="ltr">Google Chrome</span>
    یا مرورگری سازگار با بارگذاری افزونه‌های
    <span dir="ltr">Manifest V3</span>
  </li>
</ul>

<h3 dir="rtl">نصب وابستگی‌ها</h3>

<p dir="rtl">برای توسعه محلی:</p>

<pre dir="ltr"><code class="language-bash">npm install</code></pre>

<p dir="rtl">
  برای نصب قابل‌تکرار در
  <span dir="ltr">CI</span>
  یا محیط تمیز:
</p>

<pre dir="ltr"><code class="language-bash">npm ci</code></pre>

<h3 dir="rtl">اجرای تست‌ها</h3>

<pre dir="ltr"><code class="language-bash">npm test</code></pre>

<p dir="rtl">
  این فرمان تست‌های پروژه را با
  <span dir="ltr">Node.js Test Runner</span>
  اجرا می‌کند.
</p>

<blockquote dir="rtl">
  <strong>نکته:</strong>
  در
  <code dir="ltr">package.json</code>
  فقط اسکریپت
  <code dir="ltr">test</code>
  تعریف شده است. پروژه در حال حاضر اسکریپت جداگانه‌ای برای
  <code dir="ltr">dev</code>،
  <code dir="ltr">build</code>،
  <code dir="ltr">lint</code>
  یا
  <code dir="ltr">typecheck</code>
  ندارد.
</blockquote>

<h3 dir="rtl">بررسی دستی افزونه</h3>

<ol dir="rtl">
  <li>
    صفحه
    <code dir="ltr">chrome://extensions</code>
    را باز کنید.
  </li>
  <li>
    روی دکمه
    <strong dir="ltr">Reload</strong>
    کارت افزونه کلیک کنید.
  </li>
  <li>
    صفحه
    سادا
    را بازخوانی کنید.
  </li>
  <li>
    جریان دریافت دروس، استخراج کارنامه، فیلترها، بارگذاری چارت، پیشنهاد برنامه و چاپ
    <span dir="ltr">PDF</span>
    را بررسی کنید.
  </li>
</ol>

<h2 dir="rtl">🧪 CI و انتشار</h2>

<p dir="rtl">
  <span dir="ltr">Workflow</span>
  مربوط به
  <span dir="ltr">CI</span>
  در
  <span dir="ltr">Push</span>
  و
  <span dir="ltr">Pull Request</span>های
  شاخه
  <code dir="ltr">main</code>
  اجرا می‌شود و مراحل زیر را انجام می‌دهد:
</p>

<pre dir="ltr"><code>npm ci
npm test
Verify extension/manifest.json</code></pre>

<p dir="rtl">
  <span dir="ltr">Workflow</span>
  انتشار نیز برای تگ‌های
  <code dir="ltr">v*</code>
  آماده شده است. این
  <span dir="ltr">Workflow</span>
  نسخه تگ را با نسخه
  <code dir="ltr">extension/manifest.json</code>
  تطبیق می‌دهد، تست‌ها را اجرا می‌کند و محتوای پوشه
  <code dir="ltr">extension</code>
  را به‌صورت
  <span dir="ltr">ZIP</span>
  به
  <span dir="ltr">GitHub Release</span>
  اضافه می‌کند.
</p>

<h2 dir="rtl">🔐 حریم خصوصی و دسترسی‌ها</h2>

<ul dir="rtl">
  <li>
    مجوزهای افزونه به
    <code dir="ltr">storage</code>
    و
    <code dir="ltr">scripting</code>
    محدود شده‌اند.
  </li>
  <li>
    دسترسی میزبان فقط برای
    <code dir="ltr">https://sada.guilan.ac.ir/*</code>
    تعریف شده است.
  </li>
  <li>
    افزونه به مجوز عمومی
    <code dir="ltr">tabs</code>،
    <span dir="ltr">Cookie</span>ها
    یا
    <span dir="ltr">Session Token</span>ها
    دسترسی ندارد.
  </li>
  <li>
    جدول دروس، ترجیح‌ها، درس‌های گذرانده‌شده و داده ساخت‌یافته چارت در
    <code dir="ltr">chrome.storage.local</code>
    نگه‌داری می‌شوند.
  </li>
  <li>فایل خام چارت ذخیره یا به سرور خارجی ارسال نمی‌شود.</li>
  <li>افزونه انتخاب واحد را ثبت نمی‌کند و فقط یک ابزار برنامه‌ریزی است.</li>
</ul>

<blockquote dir="rtl">
  <strong>هشدار:</strong>
  رمز عبور،
  <span dir="ltr">Cookie</span>،
  <span dir="ltr">Session Token</span>،
  شماره دانشجویی یا فایل‌های آموزشی خصوصی را در
  <span dir="ltr">Issue</span>ها
  و
  <span dir="ltr">Pull Request</span>ها
  منتشر نکنید.
</blockquote>

<h2 dir="rtl">🤝 مشارکت</h2>

<p dir="rtl">
  راهنمای کامل مشارکت در
  <a href="./CONTRIBUTING.md"><code dir="ltr">CONTRIBUTING.md</code></a>
  قرار دارد. روند پیشنهادی:
</p>

<ol dir="rtl">
  <li>
    مخزن را
    <span dir="ltr">Fork</span>
    کنید.
  </li>
  <li>
    یک
    <span dir="ltr">Branch</span>
    با نام روشن بسازید.
  </li>
  <li>تغییرات را کوچک و متمرکز نگه دارید.</li>
  <li>
    <code dir="ltr">npm test</code>
    را اجرا و افزونه را با
    <strong dir="ltr">Load unpacked</strong>
    بررسی کنید.
  </li>
  <li>
    <span dir="ltr">Pull Request</span>
    را همراه با توضیح تغییر و نتیجه تست‌ها ارسال کنید.
  </li>
</ol>

<h2 dir="rtl">🐞 گزارش خطا</h2>

<p dir="rtl">
  برای گزارش مشکل، یک
  <a href="https://github.com/ariaramin/guilan-university-course-scheduler/issues/new/choose">
    <span dir="ltr">Issue</span> جدید
  </a>
  ایجاد کنید و این موارد را بنویسید:
</p>

<ul dir="rtl">
  <li>
    نسخه افزونه،
    <span dir="ltr">Chrome</span>
    و سیستم‌عامل
  </li>
  <li>مراحل دقیق بازتولید</li>
  <li>نتیجه مورد انتظار و نتیجه واقعی</li>
  <li>اسکرین‌شات یا لاگ غیرحساس</li>
</ul>

<h2 dir="rtl">⚠️ محدودیت‌ها</h2>

<ul dir="rtl">
  <li>
    دریافت دروس به ساختار فعلی صفحه و جدول
    سادا
    وابسته است.
  </li>
  <li>فقط داده‌های جدول فعلی و قابل‌مشاهده صفحه استخراج می‌شوند.</li>
  <li>
    فایل‌های باینری قدیمی
    <code dir="ltr">DOC</code>
    مستقیماً پردازش نمی‌شوند.
  </li>
  <li>
    متن داخل تصویر،
    <span dir="ltr">Text Box</span>،
    <span dir="ltr">Header</span>
    یا
    <span dir="ltr">Footer</span>
    فایل
    <span dir="ltr">Word</span>
    ممکن است به‌عنوان درس شناسایی نشود.
  </li>
  <li>
    آزمون نهایی روی
    <span dir="ltr">Session</span>
    واقعی
    سادا
    باید توسط کاربر انجام شود؛ اطلاعات ورود در محدوده پروژه قرار ندارد.
  </li>
</ul>

<h2 dir="rtl">📄 مجوز</h2>

<p dir="rtl">
  این پروژه تحت مجوز
  <a href="./LICENSE"><span dir="ltr">MIT</span></a>
  منتشر شده است.
</p>
