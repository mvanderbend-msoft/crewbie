// Served by Contoso.Outdoor.Web.Core since #35; kept for rollback until cutover.
public class CartController : Controller
{
    public ActionResult Index() => View(Cart.From(Session));

    [HttpPost, ValidateAntiForgeryToken]
    public ActionResult Add(int productId, int quantity) { Session[SessionKeys.Cart] = Cart.From(Session).Add(productId, quantity); return RedirectToAction("Index"); }
}