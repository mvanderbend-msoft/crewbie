public class OutdoorContext : DbContext
{
    public OutdoorContext() : base("name=OutdoorContext") { }
    public DbSet<Product> Products { get; set; }
    public DbSet<Order> Orders { get; set; }
}
