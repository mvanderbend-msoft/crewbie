using System.ComponentModel.DataAnnotations;

namespace Contoso.Outdoor.Domain
{
    public sealed class Address
    {
        [Required(ErrorMessage = "Enter your name.")] public string Name { get; set; }
        [Required(ErrorMessage = "Enter a street and house number.")] public string Street { get; set; }
        [Required(ErrorMessage = "Enter a postal code.")] public string PostalCode { get; set; }
        [Required(ErrorMessage = "Enter a city.")] public string City { get; set; }
    }
}