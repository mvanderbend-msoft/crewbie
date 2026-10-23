// Served by Contoso.Outdoor.Web.Core since #24; kept for rollback until cutover.
public class CatalogController : Controller
{
    private readonly OutdoorContext db = new OutdoorContext();

    public ActionResult Index(string category, int page = 1) => View(db.Products.Where(p => p.Category == category).OrderBy(p => p.Name).Skip((page - 1) * 24).Take(24).ToList());

    public ActionResult Product(string slug) => View(db.Products.Single(p => p.Slug == slug));
}
