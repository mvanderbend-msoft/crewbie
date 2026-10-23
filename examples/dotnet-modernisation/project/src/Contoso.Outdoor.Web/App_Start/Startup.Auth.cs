public partial class Startup
{
    public void ConfigureAuth(IAppBuilder app)
    {
        app.UseCookieAuthentication(new CookieAuthenticationOptions { CookieName = ".Outdoor.Auth", LoginPath = new PathString("/Account/Login") });
    }
}
